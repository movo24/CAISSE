import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from '../../common/dto';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private service: OrganizationsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List all organizations' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get organization by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create an organization' })
  create(@Body() dto: CreateOrganizationDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update an organization' })
  update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.service.update(id, dto);
  }

  @Put(':id/deactivate')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate an organization' })
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
